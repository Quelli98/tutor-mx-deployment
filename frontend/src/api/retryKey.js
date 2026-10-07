// Keep the same key after an uncertain response. Successful writes release it,
// so a later intentional submission can create a new item. Nothing is logged
// or written to browser storage; retained attempts are bounded to 100.
const attempts = new Map()
export async function withRetryKey(scope, payload, operation) {
  const signature = JSON.stringify([scope, payload])
  let key = attempts.get(signature)
  if (!key) {
    key = crypto.randomUUID()
    if (attempts.size >= 100) attempts.delete(attempts.keys().next().value)
    attempts.set(signature, key)
  }
  const result = await operation(key)
  if (attempts.get(signature) === key) attempts.delete(signature)
  return result
}

export function clearRetryKeys() { attempts.clear() }
