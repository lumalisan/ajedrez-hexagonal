/** Exact acceleration of the existing polynomial history hash, with bounded storage. */
export class RepetitionHasher {
  readonly #entries = new Map<string, { hash: number; power: number }>();

  hash(counts: Readonly<Record<string, number>>): number {
    let hash = 0;
    for (const [position, count] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
      let entry = this.#entries.get(position);
      if (!entry) {
        let textHash = 0;
        let power = 1;
        for (let index = 0; index < position.length; index += 1) {
          textHash = (textHash * 31 + position.charCodeAt(index)) | 0;
          power = Math.imul(power, 31);
        }
        entry = { hash: textHash, power };
        if (this.#entries.size < 4096) this.#entries.set(position, entry);
      }
      hash = (Math.imul(hash, entry.power) + entry.hash) | 0;
      hash = (hash * 31 + count) | 0;
    }
    return hash;
  }
}
