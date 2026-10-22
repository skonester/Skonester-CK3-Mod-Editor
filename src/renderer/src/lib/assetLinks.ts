/** Where a game file opens in the model and image browser (the /models page) */
export interface AssetTarget {
  to: '/models'
  search: { kind?: 'images'; folder: string; path: string }
}

/** A model file (.asset, .mesh) — anything else is an image */
export const isModelFile = (path: string): boolean => /\.(asset|mesh)$/i.test(path)

/**
 * "gfx/models/portraits/…/male_head.mesh" → the models page with its folder
 * listed and the file shown; an image (a texture, an icon) the same in the
 * image half of the page.
 */
export function assetTarget(path: string): AssetTarget {
  const folder = path.slice(0, Math.max(0, path.lastIndexOf('/')))
  return {
    to: '/models',
    search: isModelFile(path) ? { folder, path } : { kind: 'images', folder, path }
  }
}
