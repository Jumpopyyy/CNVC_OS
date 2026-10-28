import { useCallback, useEffect, useRef, useState } from 'react'
import { speechRecoveryDelay } from '../../server/src/contracts/dueDiligenceCollaboration'

export type SpeechInputState = 'idle' | 'requesting' | 'listening' | 'paused' | 'error' | 'complete'
type RecognitionResultLike = { 0: { transcript: string }; isFinal?: boolean }
type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { results: ArrayLike<RecognitionResultLike>; resultIndex?: number }) => void) | null
}
type RecognitionConstructor = new () => RecognitionLike

export function readSpeechRecognitionDelta(
  results: ArrayLike<RecognitionResultLike>,
  finalCursor: number,
  changedIndex = finalCursor,
) {
  let confirmed = ''
  let interim = ''
  let nextCursor = finalCursor
  const firstNewResult = Math.max(finalCursor, changedIndex)
  for (let index = firstNewResult; index < results.length; index += 1) {
    const result = results[index]
    const text = result?.[0]?.transcript || ''
    if (result?.isFinal) { confirmed += text; nextCursor = index + 1 }
    else interim += text
  }
  return { confirmed: confirmed.trim(), interim, nextCursor }
}

function recognitionConstructor() {
  const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function speechErrorMessage(error: string) {
  if (error === 'not-allowed' || error === 'service-not-allowed') return '麦克风或语音识别权限被拒绝，请在浏览器地址栏允许后重试。'
  if (error === 'audio-capture') return '未检测到可用麦克风。'
  if (error === 'network') return '浏览器语音识别网络不可用。'
  if (error === 'no-speech') return '暂未识别到语音，可继续录入或手工输入。'
  return `语音识别未完成：${error}`
}

export function useSpeechRecognition(options: {
  continuous?: boolean
  onFinal: (text: string) => void
  onInterim?: (text: string) => void
}) {
  const [state, setState] = useState<SpeechInputState>('idle')
  const [error, setError] = useState('')
  const recognizer = useRef<RecognitionLike | null>(null)
  const shouldListen = useRef(false)
  const intentionalStop = useRef(false)
  const lastInterim = useRef('')
  const finalResultCursor = useRef(0)
  const lastFinalText = useRef('')
  const lastFinalAt = useRef(0)
  const flushedInterimText = useRef('')
  const flushedInterimAt = useRef(0)
  const stopResolver = useRef<(() => void) | null>(null)
  const stopPromise = useRef<Promise<void> | null>(null)
  const stopTimer = useRef<number | null>(null)
  const restartTimer = useRef<number | null>(null)
  const recoveryAttempts = useRef(0)
  const lastError = useRef('')
  const optionsRef = useRef(options)
  optionsRef.current = options

  const flushInterim = useCallback(() => {
    const text = lastInterim.current.trim()
    if (text) {
      flushedInterimText.current = text.replace(/\s+/g, '')
      flushedInterimAt.current = Date.now()
      optionsRef.current.onFinal(text)
    }
    lastInterim.current = ''
    optionsRef.current.onInterim?.('')
  }, [])

  const createAndStart = useCallback(() => {
    const Speech = recognitionConstructor()
    if (!Speech) {
      setState('error'); setError('当前浏览器不支持实时语音识别，可继续录音或手工输入。'); return
    }
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      setState('error'); setError('语音输入需要 HTTPS 安全连接。'); return
    }
    const item = new Speech()
    finalResultCursor.current = 0
    item.lang = 'zh-CN'; item.continuous = Boolean(optionsRef.current.continuous); item.interimResults = true
    item.onstart = () => { if (recognizer.current === item) { setState('listening'); if (!recoveryAttempts.current) setError('') } }
    item.onresult = event => {
      if (recognizer.current !== item) return
      recoveryAttempts.current = 0; lastError.current = ''; setError('')
      const delta = readSpeechRecognitionDelta(event.results, finalResultCursor.current, event.resultIndex ?? finalResultCursor.current)
      finalResultCursor.current = delta.nextCursor
      if (delta.confirmed) {
        const normalized = delta.confirmed.replace(/\s+/g, '')
        const now = Date.now()
        // Some browser engines deliver the same final result again when stop()
        // flushes an interim phrase. Ignore only an immediate identical repeat;
        // later repetitions may be genuine speech and should be kept.
        const repeatedFlushedInterim = normalized === flushedInterimText.current && now - flushedInterimAt.current < 3_000
        const repeatedFinal = normalized === lastFinalText.current && now - lastFinalAt.current < 1_500
        if (!repeatedFlushedInterim && !repeatedFinal) optionsRef.current.onFinal(delta.confirmed)
        lastFinalText.current = normalized
        lastFinalAt.current = now
        flushedInterimText.current = ''
      }
      lastInterim.current = delta.interim
      optionsRef.current.onInterim?.(delta.interim)
    }
    item.onerror = event => {
      if (recognizer.current !== item) return
      if (intentionalStop.current && event.error === 'aborted') return
      if (event.error === 'no-speech' && shouldListen.current && optionsRef.current.continuous) return
      lastError.current = event.error
      if (speechRecoveryDelay(event.error, recoveryAttempts.current) === null) shouldListen.current = false
      setState('error'); setError(speechErrorMessage(event.error))
    }
    item.onend = () => {
      if (recognizer.current !== item) return
      recognizer.current = null
      if (shouldListen.current && optionsRef.current.continuous) {
        flushInterim()
        const delay = lastError.current ? speechRecoveryDelay(lastError.current, recoveryAttempts.current++) : 150
        if (delay === null) { shouldListen.current = false; setState('error'); setError('实时识别恢复失败，请手动重试。已有文字已保留。'); return }
        if (lastError.current) setError(`实时识别暂时不可用，${Math.ceil(delay / 1000)} 秒后重试（${recoveryAttempts.current}/3）。`)
        restartTimer.current = window.setTimeout(() => { restartTimer.current = null; if (shouldListen.current && !recognizer.current) createAndStart() }, delay)
      } else if (stopResolver.current) stopResolver.current()
      else {
        flushInterim()
        if (!intentionalStop.current) setState(lastError.current ? 'error' : 'complete')
      }
    }
    recognizer.current = item
    try { item.start() } catch (cause) { setState('error'); setError(cause instanceof Error ? cause.message : '语音识别启动失败') }
  }, [flushInterim])

  const start = useCallback(() => {
    if (restartTimer.current !== null) window.clearTimeout(restartTimer.current)
    restartTimer.current = null; recoveryAttempts.current = 0; lastError.current = ''
    stopResolver.current?.()
    intentionalStop.current = false; shouldListen.current = true; setState('requesting'); setError('')
    if (stopTimer.current !== null) window.clearTimeout(stopTimer.current)
    stopTimer.current = null; stopResolver.current = null
    const previous = recognizer.current; recognizer.current = null; previous?.abort?.(); createAndStart()
  }, [createAndStart])

  const stopWithState = useCallback((nextState: 'paused' | 'complete') => {
    if (restartTimer.current !== null) window.clearTimeout(restartTimer.current)
    restartTimer.current = null
    shouldListen.current = false; intentionalStop.current = true; setState(nextState)
    if (stopPromise.current) return stopPromise.current
    const current = recognizer.current
    if (!current) { flushInterim(); return Promise.resolve() }
    let resolveStop!: () => void
    const pending = new Promise<void>(resolve => { resolveStop = resolve })
    stopPromise.current = pending
    const finish = () => {
      if (stopResolver.current !== finish) return
      if (stopTimer.current !== null) window.clearTimeout(stopTimer.current)
      stopTimer.current = null
      stopResolver.current = null
      stopPromise.current = null
      if (recognizer.current === current) { recognizer.current = null; current.abort?.() }
      flushInterim()
      resolveStop()
    }
    stopResolver.current = finish
    stopTimer.current = window.setTimeout(finish, 1_200)
    try { current.stop() } catch { finish() }
    return pending
  }, [flushInterim])

  const pause = useCallback(() => stopWithState('paused'), [stopWithState])
  const stop = useCallback(() => stopWithState('complete'), [stopWithState])

  const reset = useCallback(() => { if (restartTimer.current !== null) window.clearTimeout(restartTimer.current); restartTimer.current = null; shouldListen.current = false; intentionalStop.current = true; lastInterim.current = ''; stopResolver.current?.(); if (stopTimer.current !== null) window.clearTimeout(stopTimer.current); stopTimer.current = null; const previous = recognizer.current; recognizer.current = null; previous?.abort?.(); finalResultCursor.current = 0; lastFinalText.current = ''; lastFinalAt.current = 0; flushedInterimText.current = ''; flushedInterimAt.current = 0; optionsRef.current.onInterim?.(''); setError(''); setState('idle') }, [])

  useEffect(() => () => { if (restartTimer.current !== null) window.clearTimeout(restartTimer.current); shouldListen.current = false; intentionalStop.current = true; lastInterim.current = ''; stopResolver.current?.(); if (stopTimer.current !== null) window.clearTimeout(stopTimer.current); const previous = recognizer.current; recognizer.current = null; previous?.abort?.() }, [])

  return { state, error, supported: Boolean(recognitionConstructor()), start, pause, stop, reset, flushInterim }
}
