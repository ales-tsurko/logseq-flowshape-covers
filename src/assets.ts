import { coverTitle } from './engine';

// writeAssetsdirFile is an exported Logseq desktop API, forwarded by the SDK's
// App proxy. The SDK TypeScript interface does not declare it yet.
export async function createCoverAsset(api: any, assetTagUuid: string, targetUuid: string, signature: string, svg: string, checkGraph: () => Promise<void>) {
  await checkGraph();
  const uuid: string = await api.Editor.newBlockUUID();
  const bytes = new TextEncoder().encode(svg);
  const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const path = await api.App.writeAssetsdirFile(`${uuid}.svg`, svg, '');
  if (!path) throw new Error('Logseq could not write the SVG into this graph’s assets directory');
  await checkGraph();
  const block = await api.Editor.insertBlock(assetTagUuid, coverTitle(targetUuid, signature), {
    customUUID: uuid,
    sibling: false,
    properties: {
      'logseq.property.asset/type': 'svg',
      'logseq.property.asset/size': bytes.byteLength,
      'logseq.property.asset/checksum': checksum,
    },
  });
  if (!block) throw new Error('Logseq did not create the generated asset');
  await checkGraph();
  await api.Editor.addBlockTag(uuid, assetTagUuid);
  const id = block.id ?? block['db/id'];
  if (!id) throw new Error('Logseq did not return an asset entity ID');
  return { uuid, id };
}
