/** Legacy project links open the shared workspace with its sidebar intact. */
import React from 'react';
import TaskHome from './TaskHome';
type Props = {nav: any; projectId: string; projectName: string};
export default function ProjectView({nav, projectId}: Props) {
  return <TaskHome key={projectId} nav={nav} focusTab={`project:${projectId}`} />;
}
