// Keep filesystem/config IDs lowercase; this is only the Spotify display name.
export function playlistDisplayId(id: string): string {
  return id.replace(/^kasey(?=-|$)/, "Kasey");
}
