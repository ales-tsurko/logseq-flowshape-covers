import { renderCover } from './engine';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, svg: renderCover(data.uuid, data.config, data.palette) }); }
  catch (error) { self.postMessage({ id: data.id, error: String(error) }); }
};
