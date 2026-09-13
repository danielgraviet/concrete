import { realmPlugin, addComposerChild$ } from '@mdxeditor/editor';
import { SlashCommandMenu } from './SlashCommandMenu';

/** Registers the `/` formatting typeahead inside MDXEditor. */
export const slashMenuPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, SlashCommandMenu);
  },
});
