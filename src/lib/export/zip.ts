import { downloadProjectZip } from '@/lib/vfs/zip';

export interface ZipExportOptions {
  includeBrain?: boolean;
}

export async function exportProjectAsZip(
  projectId: string,
  projectName: string,
  opts?: ZipExportOptions
): Promise<void> {
  await downloadProjectZip(projectId, projectName, {
    includeBrain: Boolean(opts?.includeBrain),
  });
}
