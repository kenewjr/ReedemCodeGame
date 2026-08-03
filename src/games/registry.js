export const GAME_REGISTRY = {
  hsr: {
    id: "hsr",
    name: "Honkai: Star Rail",
    redeemUrl: "https://hsr.hoyoverse.com/gift",
    hasWebRedemption: true
  },
  genshin: {
    id: "genshin",
    name: "Genshin Impact",
    redeemUrl: "https://genshin.hoyoverse.com/en/gift",
    hasWebRedemption: true
  },
  wuwa: {
    id: "wuwa",
    name: "Wuthering Waves",
    redeemUrl: "https://wutheringwaves.kurogames.com/",
    hasWebRedemption: false
  },
  endfield: {
    id: "endfield",
    name: "Arknights: Endfield",
    redeemUrl: "https://endfield.gryphline.com/",
    hasWebRedemption: false
  },
  nte: {
    id: "nte",
    name: "Neverness to Everness",
    redeemUrl: "https://nte.hotta.hk/",
    hasWebRedemption: false
  }
};

export function getGameMeta(gameId) {
  return GAME_REGISTRY[gameId] || {
    id: gameId,
    name: gameId ? gameId.toUpperCase() : "UNKNOWN",
    redeemUrl: "#",
    hasWebRedemption: false
  };
}
