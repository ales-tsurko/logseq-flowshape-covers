export function snapshotKey(rows: Array<[number, number]>): string {
  return JSON.stringify([...rows].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
}
