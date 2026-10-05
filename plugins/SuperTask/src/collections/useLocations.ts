import {useEffect, useState} from 'react';
import {getCache, initTaskCache, subscribeCache} from '../cache/taskCache';

// Forms opened from notes or deep links need the same cached locations as Home.
export function useLocations(fallbackProjects: any[] = []) {
  const [data, setData] = useState<any>(() => getCache());
  useEffect(() => {
    let alive = true;
    const unsubscribe = subscribeCache((value: any) => {if (alive) setData(value);});
    initTaskCache().then((value: any) => {if (alive && value) setData(value);});
    return () => {alive = false; unsubscribe();};
  }, []);
  return {projects: data?.projects || fallbackProjects, sections: data?.sections || []};
}
