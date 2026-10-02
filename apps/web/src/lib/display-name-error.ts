/**
 * Which message a rejected display name deserves. The shared schema reports an empty, a
 * whitespace-only and an over-long name through the same refinement, so the value tells them apart.
 */
export function displayNameErrorKind(value: string): 'required' | 'tooLong' {
  return value.trim().length === 0 ? 'required' : 'tooLong';
}
