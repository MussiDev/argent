/** A text field of a submitted form; file inputs and missing fields read as empty. */
export function readField(form: HTMLFormElement, name: string): string {
  const value = new FormData(form).get(name);
  return typeof value === 'string' ? value : '';
}
