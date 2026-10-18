// One writer per mounted conversation; a late history response cannot replace a reply.
export function createTwinConversationGate() {
  let revision = 0
  let writer: number | null = null
  return {
    beginLoad() { writer = null; return ++revision },
    beginWrite() {
      if (writer !== null) return null
      writer = ++revision
      return writer
    },
    isCurrent(ticket: number) { return ticket === revision },
    isWriting() { return writer !== null },
    finishWrite(ticket: number) {
      if (writer !== ticket) return false
      writer = null
      return ticket === revision
    },
    invalidate() { revision++; writer = null },
  }
}

// Clicked follow-up options did not submit the text box. Typing during a request
// belongs to the next turn, even if it begins with the text just submitted.
export function inputAfterTwinReply(currentText: string, submittedText: string | null) {
  return submittedText !== null && currentText === submittedText ? '' : currentText
}
