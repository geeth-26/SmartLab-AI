// Hand-off from other pages (e.g. the Overview composer) to the Ask page.
// File objects cannot travel through the URL, so they are held here for one navigation.
let pending = null;

export function setPendingQuestion(question, file = null, options = {}) {
  pending = { question, file, ...options };
}

export function takePendingQuestion() {
  const p = pending;
  pending = null;
  return p;
}
