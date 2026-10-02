import process from 'node:process'

export const apiPort = Number(process.env.AGENDA_TEST_PORT || 8787)
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
  throw new Error('AGENDA_TEST_PORT 必须是 1–65535 的整数。')
}
export const apiURL = `http://127.0.0.1:${apiPort}`
