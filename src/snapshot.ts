export function snapshotKey(rows: number[][]): string {
  return JSON.stringify([...rows].sort((a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const difference = (a[i] ?? -1) - (b[i] ?? -1);
      if (difference) return difference;
    }
    return 0;
  }));
}
