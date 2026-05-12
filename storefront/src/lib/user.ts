// Anonymous session id used as the cart/order key.
//
// The original storefront showed this in a "user: u17400" pill - that pill is
// gone now, but the id is still needed under the hood because the Cart and
// Orders APIs are keyed by userId. It just lives quietly in localStorage.

const KEY = "ce-408_user";

function load(): string {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = "u" + Math.floor(Math.random() * 100000);
    localStorage.setItem(KEY, id);
  }
  return id;
}

export const USER_ID = load();
