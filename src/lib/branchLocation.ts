type BranchLocation = {
  address?: string | null;
  mapsUrl?: string | null;
};

function safeGoogleMapsUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "google.com" || hostname.endsWith(".google.com"))
      ? url
      : null;
  } catch {
    return null;
  }
}

export function getBranchMapsUrl(branch: BranchLocation) {
  const preciseUrl = safeGoogleMapsUrl(branch.mapsUrl);
  if (preciseUrl) return preciseUrl.toString();
  if (!branch.address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}`;
}

export function getBranchMapEmbedUrl(branch: BranchLocation) {
  const preciseUrl = safeGoogleMapsUrl(branch.mapsUrl);
  const query = preciseUrl?.searchParams.get("q") || branch.address;
  if (!query) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}
