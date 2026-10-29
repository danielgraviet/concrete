import { realmPlugin, addComposerChild$ } from '@mdxeditor/editor';
import { SelectionFormatMenu } from './SelectionFormatMenu';

/** Registers the Notion-style floating formatting menu shown on text selection. */
export const selectionMenuPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, SelectionFormatMenu);
  },
});
