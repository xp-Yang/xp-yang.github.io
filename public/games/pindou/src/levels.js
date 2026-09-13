import {level4} from './level4.js';
import {level3} from './level3.js';
import {level8} from './level8.js';
import {level9} from './level9.js';
import {chartLevels} from './chart-levels.js';
// Extracted from the supplied recording, not randomly generated.
const recordedLevels = [
  {
    "id": 1,
    "name": "红绿拼豆",
    "target": [
      "..RR..",
      ".RRRR.",
      "RRRRRR",
      "GGGGGG",
      ".GGGG.",
      "..GG.."
    ],
    "initial": [
      "..GG..",
      ".GGGG.",
      "GGGGGG",
      "RRRRRR",
      ".RRRR.",
      "..RR.."
    ],
    "capacity": 12,
    "timeLimit": 300,
    "board": {
      "x": 166.7,
      "y": 333.3,
      "pitch": 77.55,
      "size": 68
    },
    "source": "用户录屏 0–9 秒"
  },
  {
    "id": 2,
    "name": "可爱鸡腿",
    "target": [
      "...MM............",
      "..MWWM...........",
      ".MMWWM...........",
      ".MMWWM...........",
      "MWWWWM...........",
      "MWWWWYMMMMMM.....",
      ".MMMYYYYYYYYMMM..",
      "....MYYYYYYYYYYM.",
      "....MYYYYYYYYYYYM",
      "....MYYYYYYYYYYYM",
      "....MYYYYYYMYMYYM",
      "....MBYYYYYYMYYYM",
      "....MBBBBYYYYYYYM",
      "....MBBBBYYYYYYYM",
      ".....MMBBBBBYYYYM",
      ".......MMMBBBBMM.",
      ".........MMMMM..."
    ],
    "initial": [
      "...YY............",
      "..YYYY...........",
      ".YYYYY...........",
      ".YYMMY...........",
      "YMMMMY...........",
      "YMMMMMYYYYYY.....",
      ".YYYMMMMMMMMYYY..",
      "....YMMMMMMMMMMY.",
      "....YMMMMMMMMMMMY",
      "....YMMMMMMMMMMMY",
      "....YMMMMBBYBYBBY",
      "....YYBBBBBBYBBBY",
      "....YYYYYBBBBWWWY",
      "....YYYYYWWWWWWWY",
      ".....YYYYYYYWWWWY",
      ".......YYYYYYYYY.",
      ".........YYYYY..."
    ],
    "capacity": 48,
    "timeLimit": 300,
    "board": {
      "x": 76.5,
      "y": 244.5,
      "pitch": 35.43,
      "size": 31
    },
    "source": "用户录屏 14 秒预览、18 秒初始布局"
  }
];
export const levels = [...recordedLevels,level3,level4,level8,level9,...chartLevels].sort((a,b)=>a.id-b.id);
