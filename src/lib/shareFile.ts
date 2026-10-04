import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/** Hands a text file to the user: the share sheet on phones, a download on web. */
export async function shareTextFile(
  name: string,
  content: string,
  options: { mimeType: string; uti?: string; dialogTitle: string },
): Promise<void> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([content], { type: options.mimeType }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device');
  await Sharing.shareAsync(file.uri, { mimeType: options.mimeType, dialogTitle: options.dialogTitle, UTI: options.uti });
}
