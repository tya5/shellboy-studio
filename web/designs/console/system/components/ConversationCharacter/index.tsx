import thinking from '../../../../../app/public/characters/thinking-24.svg?raw';
import { characterAssets } from '../../character-assets';

// Keep each dot in its own wrapper so its hop transform does not target an SVG root.
const artwork = thinking.slice(thinking.indexOf('<rect'), thinking.lastIndexOf('</svg>')).replace(/ id="[^"]*"/g, '');
const dotPattern = /<circle\b[^>]*\/>/g;
const thinkingDots = artwork.match(dotPattern) ?? [];
const thinkingFace = artwork.replace(dotPattern, '');

export function ConversationCharacter({ name, running }: { name: string; running: boolean }) {
  return name === 'thinking'
    ? <span class="character-status character-thinking" data-running={running ? '' : undefined} aria-hidden="true">
        <svg viewBox="0 0 390 390" dangerouslySetInnerHTML={{ __html: thinkingFace }} />
        {thinkingDots.map((dot, index) => <span key={index} class="character-dot-motion" data-running={running ? "" : undefined}><svg class="character-dot" viewBox="0 0 390 390" dangerouslySetInnerHTML={{ __html: dot }} /></span>)}
      </span>
    : <img class="character-status" src={characterAssets[name]} alt="" />;
}
