import React from 'react';
import Config from './Config';

/** Compatibility route for older callers; Config owns AI settings state and persistence. */
export default function AISettings({nav}: {nav: any}) {
  return <Config nav={nav} onNavigate={(screen: string) => nav?.resetTo?.(screen)} initialPage="setup" />;
}
