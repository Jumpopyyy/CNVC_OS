import { AlignmentType, BorderStyle, Document, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType } from 'docx'
import { dueDiligenceCategory } from '../contracts/digitalTwinTemplates.js'

export type DueDiligenceQuestionDocumentInput = {
  title: string
  projectName: string
  generatedAt?: Date
  questions: Array<{
    title: string
    category: string
    priority: string
    rationale: string
    evidenceRequirement: string
  }>
}

export async function buildDueDiligenceQuestionPackDocx(input: DueDiligenceQuestionDocumentInput) {
  // Match the usable A4 width; broad category names fit on one readable line.
  const widths = [720, 3600, 1300, 850, 3996]
  const documentFont = { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Songti SC', cs: 'Arial' }
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    left: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
    right: { style: BorderStyle.SINGLE, size: 4, color: 'D9D9D9' },
  }
  const makeCell = (children: Paragraph[], column: number, rowIndex: number, header = false) => new TableCell({
    width: { size: widths[column], type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: header ? '245E5A' : rowIndex % 2 === 0 ? 'F3F7F6' : 'FFFFFF' },
    margins: { top: 70, bottom: 70, left: 120, right: 120 },
    verticalAlign: VerticalAlign.CENTER,
    borders: cellBorders,
    children,
  })
  const bodyParagraph = (text: string, bold = false, alignment: typeof AlignmentType[keyof typeof AlignmentType] = AlignmentType.LEFT) => new Paragraph({
    alignment,
    spacing: { before: 0, after: 40, line: 250 },
    children: [new TextRun({ text, font: documentFont, size: 20, bold, color: '263B3A' })],
  })
  const header = new TableRow({ tableHeader: true, cantSplit: true, children: ['序号', '核查问题', '类别', '优先级', '核查目标与所需证据'].map((text, column) => makeCell([
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0 }, children: [new TextRun({ text, bold: true, font: documentFont, size: 19, color: 'FFFFFF' })] }),
  ], column, 0, true)) })
  const rows = [header, ...input.questions.map((question, index) => {
    const detail: Paragraph[] = []
    const genericRationale = '股权投资标准尽调核查项，请结合项目实际情况核验。'
    if (question.rationale?.trim() && question.rationale.trim() !== genericRationale) detail.push(bodyParagraph(`核查重点：${question.rationale.trim()}`))
    if (question.evidenceRequirement?.trim()) detail.push(bodyParagraph(`所需证据：${question.evidenceRequirement.trim()}`))
    if (!detail.length) detail.push(bodyParagraph('—'))
    const columns = [
      [bodyParagraph(String(index + 1), false, AlignmentType.CENTER)],
      [bodyParagraph(question.title, true)],
      [bodyParagraph(dueDiligenceCategory(question.category), false, AlignmentType.CENTER)],
      [bodyParagraph(question.priority, true, AlignmentType.CENTER)],
      detail,
    ]
    return new TableRow({ cantSplit: true, children: columns.map((children, column) => makeCell(children, column, index + 1)) })
  })]
  const generatedAt = input.generatedAt ?? new Date()
  const doc = new Document({ sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 760, right: 720, bottom: 760, left: 720 } } }, children: [
    new Paragraph({ style: 'Title', alignment: AlignmentType.CENTER, spacing: { before: 0, after: 140 }, children: [new TextRun({ text: input.title, bold: true, size: 32, font: { ...documentFont, eastAsia: 'STHeiti' }, color: '000000' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 260 }, children: [new TextRun({ text: `${input.projectName}  ·  ${generatedAt.toLocaleDateString('zh-CN')}`, size: 20, font: documentFont, color: '637573' })] }),
    new Table({ width: { size: widths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED, margins: { top: 120, bottom: 120, left: 120, right: 120 }, rows }),
  ] }] })
  return Packer.toBuffer(doc)
}
