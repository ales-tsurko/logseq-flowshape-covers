export function shouldScan(event: { txData?: any[][] }): boolean {
  // The DB runtime publishes changed blocks with txData: [] rather than raw
  // datoms. An empty array means the attribute filter is unavailable.
  if (!event.txData?.length) return true;
  return event.txData.some(d => {
    const attribute = String(d[1]).replace(/^:/, '');
    return ['block/tags', 'logseq.property.class/extends', 'logseq.property/deleted-at'].includes(attribute)
      || attribute.startsWith('user.property/Cover');
  });
}
