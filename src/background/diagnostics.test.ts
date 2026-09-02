import { redactDiagnosticText } from './diagnostics'

describe('diagnostic log redaction', () => {
  it('redacts API keys, bearer tokens, and query credentials', () => {
    const input = 'Bearer secret-token sk-example123456789 https://api.test/path?api_key=private-key&x=1'
    const output = redactDiagnosticText(input)
    expect(output).not.toContain('secret-token')
    expect(output).not.toContain('sk-example123456789')
    expect(output).not.toContain('private-key')
    expect(output).toContain('[REDACTED]')
  })

  it('limits persisted diagnostic message length', () => {
    expect(redactDiagnosticText('x'.repeat(2_000))).toHaveLength(800)
  })
})
