import { isSafeHttpUrl, splitSourcesFooterForDisplay, type SourceDisplayLink } from '@jarvis/core';

export function SourcesLine({ text }: { text: string }) {
  const { links } = splitSourcesFooterForDisplay(text);
  if (links.length === 0) return null;
  return (
    <p className="sources-compact">
      <span className="sources-compact-label">Sources : </span>
      {links.map((link, index) => (
        <span key={`${link.url}-${index}`}>
          {index > 0 ? ', ' : null}
          <SourceAnchor link={link} />
        </span>
      ))}
    </p>
  );
}

function SourceAnchor({ link }: { link: SourceDisplayLink }) {
  if (!isSafeHttpUrl(link.url)) {
    return <span>{link.label}</span>;
  }
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer">
      {link.label}
    </a>
  );
}
