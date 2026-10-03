import {PluginCommAPI} from 'sn-plugin-lib';
import {privateStorage} from '../offline/privateStorage';
export async function capturePreview(): Promise<string | undefined> {
  const {directory, storage} = await privateStorage();
  const [id] = JSON.parse(await storage.newIds(1));
  const path = `${directory}/capture-${id}.png`;
  try {
    const result: any = await PluginCommAPI.generateLassoPreview(path);
    if (!result?.success || result.result?.imagePath !== path) return undefined;
    return await storage.readPreview(path, result.result.rotateDegree || 0);
  } finally { await storage.deletePreview(path).catch(() => {}); }
}
