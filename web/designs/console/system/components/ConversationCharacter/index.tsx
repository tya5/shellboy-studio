import thinking from '../../../../../app/public/characters/thinking-24.svg?raw';
import { characterAssets } from '../../character-assets';

// Use sibling SVG roots so the dots can still hop independently without animating SVG children.
const artwork = thinking.slice(thinking.indexOf('<rect'), thinking.lastIndexOf('</svg>')).replace(/ id="[^"]*"/g, '');
const dotPattern = /<circle\b[^>]*\/>/g;
const thinkingDots = artwork.match(dotPattern) ?? [];
const thinkingFace = artwork.replace(dotPattern, '');

export function ConversationCharacter({ name, running }: { name: string; running: boolean }) {
  return name === 'thinking'
    ? <span class="character-status character-thinking" data-running={running ? '' : undefined} aria-hidden="true">
        <svg viewBox="0 0 390 390" dangerouslySetInnerHTML={{ __html: thinkingFace }} />
        {thinkingDots.map((dot, index) => <svg key={index} class="character-dot" viewBox="0 0 390 390" dangerouslySetInnerHTML={{ __html: dot }} />)}
      </span>
    : <img class="character-status" src={characterAssets[name]} alt="" />;
}
