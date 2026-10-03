// Expand the setup section reached from an OS download card or shared link.
function revealSetup() {
  const target = document.getElementById(location.hash.slice(1));
  if (target?.tagName === 'DETAILS') target.open = true;
}
window.addEventListener('hashchange', revealSetup);
revealSetup();
