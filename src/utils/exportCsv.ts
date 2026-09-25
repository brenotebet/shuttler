// src/utils/exportCsv.ts
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

// Writes CSV content to a temp file and shares it as a real .csv attachment —
// Mail/Messages/Drive treat it as a file to open in Excel/Sheets, instead of
// pasting the raw text into the share sheet's message body.
export async function shareCsvFile(csv: string, filename: string, dialogTitle?: string) {
  const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  const file = new File(Paths.cache, safeName);
  if (file.exists) file.delete();
  file.write(csv);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/csv',
      dialogTitle: dialogTitle ?? safeName,
      UTI: 'public.comma-separated-values-text',
    });
  } else {
    // Rare fallback (no share sheet available on the device) — same behavior as before.
    await Share.share({ message: csv, title: dialogTitle });
  }
}
