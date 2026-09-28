function androidUpdateAvailable(release, installedBuild) {
  const current = Number(installedBuild);
  const latest = Number(release?.versionCode);
  return Number.isInteger(current) && current > 0 && Number.isInteger(latest)
    && latest > current && release?.packageName === 'com.parispromax.app';
}
module.exports = { androidUpdateAvailable };
