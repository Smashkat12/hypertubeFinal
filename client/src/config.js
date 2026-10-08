const hostname = window.location.hostname;
const port = window.location.protocol === "https:" ? "8443" : "5000";
const serverURL = window.API_URL;

// Avatars of our own uploads are stored host-less (older rows may still carry a
// localhost/LAN origin); point them at whichever API host this page is using.
export const avatarSrc = (avatar) =>
  avatar && avatar.replace(/^(https?:\/\/[^/]+)?(?=\/public\/avatars\/)/, serverURL);

export default { hostname, port, serverURL }
