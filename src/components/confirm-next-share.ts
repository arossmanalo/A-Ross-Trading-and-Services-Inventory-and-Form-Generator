import { Alert } from 'react-native';

import type { ShareStep } from '@/features/documents/share-sequence';

/**
 * Asked between share sheets. Waiting for a tap guarantees the app is back in
 * the foreground, which Android requires before it will open another sheet.
 */
export function confirmNextShare(next: ShareStep): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      `Share the ${next.title} too?`,
      `The first share sheet has closed. Next file:\n${next.fileName}`,
      [
        { text: 'Skip', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Share', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
