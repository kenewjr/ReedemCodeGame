export const SOURCES = [
  // HSR
  {
    id: "hsr-hoyo-codes",
    game: "hsr",
    type: "hoyo-codes-json",
    url: "https://hoyo-codes.seria.moe/codes?game=hkrpg",
    enabled: true
  },
  {
    id: "hsr-fandom",
    game: "hsr",
    type: "fandom-wikitext",
    url: "https://honkai-star-rail.fandom.com/api.php?action=parse&page=Redemption_Code&prop=wikitext&format=json",
    enabled: true
  },
  {
    id: "hsr-game8",
    game: "hsr",
    type: "html-cheerio",
    url: "https://game8.co/games/Honkai-Star-Rail/archives/410296",
    enabled: true
  },
  {
    id: "hsr-pcgamesn",
    game: "hsr",
    type: "html-cheerio",
    url: "https://www.pcgamesn.com/honkai-star-rail/codes",
    enabled: true
  },
  {
    id: "hsr-destructoid",
    game: "hsr",
    type: "html-cheerio",
    url: "https://www.destructoid.com/honkai-star-rail-codes/",
    enabled: true
  },

  // Genshin Impact
  {
    id: "genshin-hoyo-codes",
    game: "genshin",
    type: "hoyo-codes-json",
    url: "https://hoyo-codes.seria.moe/codes?game=genshin",
    enabled: true
  },
  {
    id: "genshin-fandom",
    game: "genshin",
    type: "fandom-wikitext",
    url: "https://genshin-impact.fandom.com/api.php?action=parse&page=Promotional_Code&prop=wikitext&format=json",
    enabled: true
  },
  {
    id: "genshin-game8",
    game: "genshin",
    type: "html-cheerio",
    url: "https://game8.co/games/Genshin-Impact/archives/304759",
    enabled: true
  },
  {
    id: "genshin-siliconera",
    game: "genshin",
    type: "html-cheerio",
    url: "https://www.siliconera.com/genshin-impact-codes/",
    enabled: true
  },
  {
    id: "genshin-vg247",
    game: "genshin",
    type: "html-cheerio",
    url: "https://www.vg247.com/genshin-impact-codes",
    enabled: true
  },
  {
    id: "genshin-rockpapershotgun",
    game: "genshin",
    type: "html-cheerio",
    url: "https://www.rockpapershotgun.com/genshin-impact-codes-list",
    enabled: true
  },

  // Wuthering Waves
  {
    id: "wuwa-fandom",
    game: "wuwa",
    type: "fandom-wikitext",
    url: "https://wutheringwaves.fandom.com/api.php?action=parse&page=Redemption_Code&prop=wikitext&format=json",
    enabled: true
  },
  {
    id: "wuwa-pcgamesn",
    game: "wuwa",
    type: "html-cheerio",
    url: "https://www.pcgamesn.com/wuthering-waves/codes",
    enabled: true
  },
  {
    id: "wuwa-destructoid",
    game: "wuwa",
    type: "html-cheerio",
    url: "https://www.destructoid.com/wuthering-waves-codes/",
    enabled: true
  },
  {
    id: "wuwa-pcgamer",
    game: "wuwa",
    type: "html-cheerio",
    url: "https://www.pcgamer.com/games/rpg/wuthering-waves-codes/",
    enabled: true
  },
  {
    id: "wuwa-game8",
    game: "wuwa",
    type: "html-cheerio",
    url: "https://game8.co/games/Wuthering-Waves/archives/453149",
    enabled: true
  },

  // Arknights: Endfield
  {
    id: "endfield-game8",
    game: "endfield",
    type: "html-cheerio",
    url: "https://game8.co/games/Arknights-Endfield/archives/571509",
    enabled: true
  },
  {
    id: "endfield-gamesradar",
    game: "endfield",
    type: "html-cheerio",
    url: "https://www.gamesradar.com/games/rpg/arknights-endfield-codes/",
    enabled: true
  },

  // Neverness to Everness
  {
    id: "nte-pcgamesn",
    game: "nte",
    type: "html-cheerio",
    url: "https://www.pcgamesn.com/neverness-to-everness/codes",
    enabled: true
  },
  {
    id: "nte-dotgg",
    game: "nte",
    type: "html-cheerio",
    url: "https://dotgg.gg/nte/codes",
    enabled: true
  },
  {
    id: "nte-game8",
    game: "nte",
    type: "html-cheerio",
    url: "https://game8.co/games/Neverness-to-Everness/archives/593718",
    enabled: true
  }
];
