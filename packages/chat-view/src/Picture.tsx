import { useState } from 'react';

/**
 * A picture shown small (28h D57 (b)): in a chip before it is sent and in the message that sent it. A click shows it full size over the chat; a
 * click anywhere or Escape closes that again.
 */
export function Picture({ src, name }: { src: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="picture-thumb" title={`Show ${name} full size`} onClick={() => setOpen(true)}>
        <img src={src} alt={name} />
      </button>
      {open ? (
        <div className="picture-full" role="dialog" aria-label={name} title="Click or press Escape to close" tabIndex={-1}
          ref={element => element?.focus()} onClick={() => setOpen(false)} onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); } }}>
          <img src={src} alt={name} />
        </div>
      ) : null}
    </>
  );
}
