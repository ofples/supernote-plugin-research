import {NativeModules} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
let prepared = null;
export async function privateStorage() {
  if (!prepared) {
    prepared = (async () => {
      const storage = NativeModules.TaskStorage;
      if (!storage) throw new Error('Install the complete updated SuperTask package to enable private storage.');
      const path = await PluginManager.getPluginDirPath();
      if (!path) throw new Error('PluginHost did not provide private storage.');
      const directory = await storage.prepare(path);
      return {storage, directory};
    })().catch(error => { prepared = null; throw error; });
  }
  return prepared;
}
