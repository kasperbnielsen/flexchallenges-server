import { Router } from "express";
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import champions from "../assets/champions";

const masteryRouter = Router();

masteryRouter.get("/puuids", (req, res) => {
  res.status(200);
  res.send("hello world 2 !");
});

const APIKEY = process.env.API_KEY;
if (!APIKEY) throw new Error("API-KEY Missing!");
const REDISHOST = process.env.REDIS_HOST;
if (!REDISHOST) throw new Error("REDISHOST Missing!");
const MONGODBHOST = process.env.MONGODB_HOST;
if (!MONGODBHOST) throw new Error("MONGODBHOST Mssing!");

const databaseClient = new MongoClient(MONGODBHOST);
const client = new Redis(REDISHOST);
const connection = databaseClient.connect().then((c) => c.db("production"));

type Mastery = Array<{
  championId: number;
  championPoints: number;
  puuid: string;
}>;

function getChampions(region: string[]) {
  const champList = new Set<string>();

  while (champList.size < 5) {
    const n = Math.floor(Math.random() * region.length);
    champList.add(region[n]);
  }
  return Array.from(champList);
}

function getEasyChampions(region: string[]) {
  const champList = new Set<string>();
  const roles = [
    champions.bot,
    champions.support,
    champions.jungler,
    champions.mid,
    champions.top,
  ];
  for (let j = 0; j < 5; j++) {
    const shuffledArray = Object.keys(region).sort(() => 0.5 - Math.random());
    for (let k = 0; k < region.length; k++) {
      if (roles[j].includes(region[+shuffledArray[k]])) {
        champList.add(region[+shuffledArray[k]]);
        break;
      }
    }
  }

  while (champList.size < 5) {
    champList.add(region[Math.floor(Math.random() * region[0].length)]);
  }

  console.log(champList);
  return Array.from(champList);
}

function getPlayerMastery(champs: Mastery, champList: string[]) {
  const playerMasteries: number[] = [1, 1, 1, 1, 1];
  for (let i = 0; i < champList.length; i++) {
    for (let j = 0; j < champs.length; j++) {
      if (champs[j].championId.toString() === champList[i]) {
        playerMasteries[i] = champs[j].championPoints;
      }
    }
  }
  return playerMasteries;
}

let random: number;

function getKeys(championList: string[]) {
  const keyList: string[] = [];
  championList.forEach((element) => {
    if (champions.champions.hasOwnProperty(element)) {
      keyList.push(
        champions.champions[element as keyof typeof champions.champions]
      );
    }
  });
  return keyList;
}

function decode(input: string) {
  const padded = input.padEnd(input.length + (4 - (input.length % 4)), "=");

  const json = Buffer.from(padded, "base64").toString();
  return JSON.parse(json);
}

function getMax(arr: number[]) {
  let tempMax = 0;
  arr.forEach((element) => {
    if (element > tempMax) {
      tempMax = element;
    }
  });
  return tempMax;
}

// Returns which index point[index], contains the biggest number
function getHighest(points: number[][]) {
  let maximum = 0;
  let index = 0;
  points.forEach((element, i) => {
    const temp = getMax(element);
    if (maximum < temp) {
      maximum = temp;
      index = i;
    }
  });
  return index;
}

async function getMastery(puuid: string, apiKey: string): Promise<Mastery> {
  const url = `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}?api_key=${apiKey}`;
  return await fetch(url, { method: "GET" })
    .then((res) => {
      console.log("fetch mastery");
      return res.json();
    })
    .catch((err) => {
      console.log(err);
    });
}

async function getId(username: string, apiKey: string, region: string) {
  const url = `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-name/${username}?api_key=${apiKey}`;
  const collection = (await connection).collection<{
    username: string;
    puuid: string;
    region: string;
  }>("puuid");
  const user = await collection.findOne({ username, region });
  if (user) {
    return user;
  }
  const data = await fetch(url, { method: "GET" }).then((response) => {
    console.log("fetch id");
    return response.json();
  });
  if (data?.status?.status_code === 429) {
    throw new Error("Ratelimit reached");
  }

  return (
    (await collection.findOneAndUpdate(
      { puuid: data.puuid },
      {
        $set: {
          username,
          region,
          name: data.name,
          profileIconId: data.profileIconId,
          revisionDate: data.revisionDate,
          summonerLevel: data.summonerLevel,
        },
        $setOnInsert: {
          accountId: data.accountId,
          summonerId: data.id,
          puuid: data.puuid,
        },
      },
      { upsert: true, returnDocument: "after" }
    )) || data
  );
}

masteryRouter.get("/:nameslist", async (req, res) => {
  if (!req.params.nameslist) {
    res.status(400).send();
    return;
  }

  const names: {
    list: string[];
    options: string[];
    isRegions: boolean;
    easyMode: boolean;
    serverRegion: string;
  } = decode(req.params.nameslist);
  let region: string[];

  names.list = names.list.map((e) => e.toLowerCase().trim());

  console.log(names.easyMode ? "true" : "false");
  const randomRegion = Math.floor(Math.random() * names.options.length);

  if (names.options.length === 0) {
    region = names.isRegions
      ? champions.regionsList[randomRegion]
      : champions.teamCompsList[randomRegion];
  } else {
    region = names.isRegions
      ? // @ts-expect-error element implicitly has an 'any' type
        champions.regions[names.options[randomRegion]]
      : // @ts-expect-error element implicitly has an 'any' type
        champions.teamComps[names.options[randomRegion]];
  }

  const champs = names.easyMode
    ? getEasyChampions(region)
    : getChampions(region);

  const keys = getKeys(champs);

  const masteryPoints: Array<Array<number>> = [];

  for (const name of names.list) {
    const id = await getId(name, APIKEY, names.serverRegion);
    if (id === "") {
      res.status(429).send();
      return;
    }

    const entries = await client.hgetall(`${id?.puuid}`);
    let mastery: Mastery = [];

    if (Object.keys(entries).length) {
      let objKeys = Object.keys(entries);
      let objValues = Object.values(entries);
      for (let i = 0; i < objKeys.length; i++) {
        mastery[i] = {
          championId: +objKeys[i],
          championPoints: +objValues[i],
          puuid: id.puuid,
        };
      }
      const playerMastery = getPlayerMastery(mastery, keys);
      console.log("player : ", playerMastery);
      masteryPoints.push(playerMastery);
      continue;
    }

    mastery = await getMastery(id?.puuid, APIKEY);

    let map: Record<string, number> = {};
    for (let i = 0; i < mastery.length; i++) {
      map[mastery[i].championId] = mastery[i].championPoints;
    }

    try {
      await client.hmset(id?.puuid, map).then(() => {
        client.expire(name, 36000);
      });
    } catch (err) {
      console.error(err);
    }

    const playerMastery = getPlayerMastery(mastery, keys);
    masteryPoints.push(playerMastery);
    continue;
  }
  console.log(masteryPoints);

  const newChampList = [];
  const orderList = [];
  const assignedChamps = [];

  for (let i = 0; i < 5; i++) {
    const indexOfPlayer = getHighest(masteryPoints);
    const indexOfChampion = masteryPoints[indexOfPlayer].findIndex(
      (element) => element === getMax(masteryPoints[indexOfPlayer])
    );

    assignedChamps[indexOfPlayer] = keys[indexOfChampion];
    newChampList[indexOfPlayer] = champs[indexOfChampion];
    orderList[indexOfPlayer] = indexOfChampion;

    masteryPoints[indexOfPlayer] = [0, 0, 0, 0, 0];

    for (let j = 0; j < 5; j++) {
      masteryPoints[j][indexOfChampion] = 0;
    }
  }

  const myObject2 = {
    players: {
      player1: {
        name: names.list[0],
        assignedChamp: assignedChamps[0],
        key: newChampList[0],
      },
      player2: {
        name: names.list[1],
        assignedChamp: assignedChamps[1],
        key: newChampList[1],
      },
      player3: {
        name: names.list[2],
        assignedChamp: assignedChamps[2],
        key: newChampList[2],
      },
      player4: {
        name: names.list[3],
        assignedChamp: assignedChamps[3],
        key: newChampList[3],
      },
      player5: {
        name: names.list[4],
        assignedChamp: assignedChamps[4],
        key: newChampList[4],
      },
    },
    region: names.options[randomRegion],
    order: orderList,
  };

  res.status(200).send(myObject2);
});

export default masteryRouter;
