# Latin Revision V8 — QA report

## Bank integrity

- 1,056 questions; 1,056 unique IDs.
- No duplicate date/direction/context/question fingerprints.
- Every MC answer appears in its option list.
- Every typed question has the required answer schema.
- 23 Aug contains `ad urbem` only.
- 24 Aug contains `ad villam` paragraphs 1–3 only.
- 25 Aug contains `ad villam` paragraphs 4–6 only.
- No questions are assigned to the 2–8 Aug travel/rest dates.

## Reported answer cases

- `under` for `sub + ablative`: accepted.
- Teacher labels such as `(position)` and `(movement)`: optional.
- `he carries` and `she carries`: accepted for the compact `he/she carries` source meaning.
- `nostri` or `nostrum`: either accepted.
- Three possessive forms: accepted with commas, slashes, `and`, spaces, different order and different capitalisation.
- Missing and incorrect extra three-form items: identified separately.
- Normal Latin word-order variation: accepted.
- An unrelated extra Latin token: rejected.

## Practice simulations

- 15-question focus session: at least six written/translation questions when the unseen pool permits.
- 16 Aug cumulative block: 12 current-day focus questions + 3 earlier review questions.
- 30 Aug assessment: simulated 30-question draw covered all 20 source dates.
- Mastery: simulated complete 34-question focus cycle at 29/34 produced 85%; a single 15-question session alone does not create mastery.

## Technical checks

- JavaScript syntax passed for `app.js` and `question-bank.js`.
- V8 cache includes `app.js` and uses a new cache key.
- Manifest retains a white background and standalone PWA display.
- V7 attempts, saved mistakes and due dates migrate; old no-repeat cycles reset so V8 mastery starts cleanly.
