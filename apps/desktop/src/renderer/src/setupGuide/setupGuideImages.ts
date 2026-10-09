const modules = import.meta.glob<string>('../assets/setup-tuto/*.png', {
  eager: true,
  import: 'default',
});

export function setupGuideImageUrl(fileName: string): string {
  const key = `../assets/setup-tuto/${fileName}`;
  const url = modules[key];
  if (!url) {
    throw new Error(`Image tutoriel manquante : ${fileName}`);
  }
  return url;
}
