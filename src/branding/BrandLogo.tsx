import type { BrandLogoId } from '../settings/types';
import tripleC from '../../docs/design/triple-c.svg?url';
import squareBoxy from '../../docs/design/square-boxy-logo-concrete-text-under.svg?url';
import cinderblock from '../../docs/design/cinderblock-concrete-text-belwo.svg?url';
import fullTextBlocks from '../../docs/design/full-text-blocks.svg?url';

const LOGO_SOURCES: Record<BrandLogoId, string> = {
  'triple-c': tripleC,
  'square-boxy': squareBoxy,
  cinderblock,
  'full-text-blocks': fullTextBlocks,
};

export function BrandLogo({
  logo,
  className,
}: {
  logo: BrandLogoId;
  className?: string;
}) {
  return <img className={className ?? 'brand-logo'} src={LOGO_SOURCES[logo]} alt="" aria-hidden="true" />;
}
