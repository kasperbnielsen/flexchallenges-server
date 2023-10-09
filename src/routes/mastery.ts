import { Router } from "express";
//import { Redis } from "ioredis";
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
//const client = new Redis(REDISHOST);
const connection = databaseClient.connect().then((c) => c.db("production"));

type Masteries = Array<{
  championId: number;
  championPoints: number;
  championLevel: number;
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

function getPlayerMastery(champs: Masteries, champList: string[]) {
  const playerMasteries: number[] = [1, 1, 1, 1, 1];
  const playerLevels: number[] = [];
  for (let i = 0; i < champList.length; i++) {
    for (let j = 0; j < champs.length; j++) {
      if (champs[j].championId.toString() === champList[i]) {
        playerMasteries[i] = champs[j].championPoints;
        playerLevels[i] = champs[j].championLevel;
      }
    }
  }
  return { playerMasteries, playerLevels };
}

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

async function getMastery(puuid: string, apiKey: string): Promise<Masteries> {
  const url = `https://euw1.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}?api_key=${apiKey}`;
  const collection = (await connection).collection<{
    createdAt: Date;
    masteries: Masteries;
    puuid: string;
  }>("mastery");
  const mastery = await collection.findOne({ puuid });
  if (mastery) return mastery.masteries;
  const data = await fetch(url, { method: "GET" })
    .then((res) => {
      console.log("fetch mastery");
      if (res.status === 200) return res.json();
      return null;
    })
    .catch((err) => {
      console.log(err);
      return null;
    });
  if (!data) console.log("data is null");
  //await collection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
  await collection
    .updateOne(
      { puuid },
      {
        $set: {
          masteries: data,
        },
        $setOnInsert: {
          createdAt: new Date(),
          puuid,
        },
      },
      { upsert: true }
    )
    .then(() => {
      console.log("success:", data);
      return data;
    })
    .catch(() => {
      console.log("err:", data);

      return data;
    });
  return data;
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

async function getMatch(matchId: string) {
  const url = `https://europe.api.riotgames.com/lol/match/v5/matches/${matchId}?api_key=${APIKEY}`;

  const data = await fetch(url, { method: "GET" }).then((response) => {
    return response.json();
  });

  return data;
}

async function getMatchIds(puuid: string) {
  const url = `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?type=ranked&start=0&count=100&api_key=${APIKEY}`;

  const data = await fetch(url, { method: "GET" }).then((response) => {
    return response.json();
  });

  return data;
}

async function getProfile(summonerId: string) {
  const url = `https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}?api_key=${APIKEY}`;
  const data = await fetch(url, { method: "GET" }).then((response) =>
    response.json()
  );

  return data;
}

masteryRouter.get("/profile/:id", async (req, res) => {
  if (!req.params.id) {
    res.status(400).send("wrong id");
    return;
  }

  const data: {
    id: string;
  } = decode(req.params.id);

  const profileData = await getProfile(data.id);

  res.status(200).send({ data: profileData });
});

masteryRouter.get("/player/:data", async (req, res) => {
  if (!req.params.data) {
    res.status(400).send("no data");
    return;
  }

  const data: {
    data: string;
  } = decode(req.params.data);

  const matchIds = await getMatchIds(data.data);
  const batchedMatches: Array<Array<string>> = [];
  for (let i = 0; i < 10; i++) {
    const tempArr: string[] = [];
    for (let j = 0; j < 10; j++) {
      tempArr.push(matchIds[i * 10 + j]);
    }
    batchedMatches.push(tempArr);
  }

  const matchListData = [];
  for (let i = 0; i < batchedMatches[0].length; i++) {
    matchListData.push(await getMatch(batchedMatches[0][i]));
  }

  console.log(matchListData);

  res.status(200).send({ data: matchListData });
});

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
  const masteryLevels: Array<Array<number>> = [];
  const puuids = [];

  for (const name of names.list) {
    const id = await getId(name, APIKEY, names.serverRegion);
    if (id === "") {
      res.status(429).send();
      return;
    }

    /* const entries = await client.hgetall(`${id?.puuid}`);
    let mastery: Mastery = [];

    if (Object.keys(entries).length) {
      let objKeys = Object.keys(entries);
      let objValues = Object.values(entries);
      for (let i = 0; i < objKeys.length; i++) {
        mastery[i] = {
          championId: +objKeys[i],
          championPoints: +objValues[i],
          puuid: id.puuid,
          championLevel: 123,
        };
      }
      const playerMastery = getPlayerMastery(mastery, keys);
      console.log("player : ", playerMastery);
      masteryPoints.push(playerMastery);
      continue;
    }*/

    puuids.push(id?.puuid);
    const mastery = await getMastery(id?.puuid, APIKEY);

    /*let map: Record<string, number> = {};
    for (let i = 0; i < mastery.length; i++) {
      map[mastery[i].championId] = mastery[i].championPoints;
    }

    try {
      await client.hmset(id?.puuid, map).then(() => {
        client.expire(id?.puuid, 36000);
      });
    } catch (err) {
      console.error(err);
    }*/

    if (!mastery) {
      res.status(400).send({ error: "mastery not defined" });
      return;
    }
    const playerMastery = getPlayerMastery(mastery, keys);
    masteryPoints.push(playerMastery.playerMasteries);
    masteryLevels.push(playerMastery.playerLevels);
    continue;
  }
  console.log(masteryPoints);

  const newChampList = [];
  const orderList = [];
  const assignedChamps = [];
  const assignedPoints = [];
  const assignedLevels = [];

  for (let i = 0; i < 5; i++) {
    const indexOfPlayer = getHighest(masteryPoints);
    const indexOfChampion = masteryPoints[indexOfPlayer].findIndex(
      (element) => element === getMax(masteryPoints[indexOfPlayer])
    );

    assignedChamps[indexOfPlayer] = keys[indexOfChampion];
    newChampList[indexOfPlayer] = champs[indexOfChampion];
    orderList[indexOfPlayer] = indexOfChampion;
    assignedPoints[indexOfPlayer] =
      masteryPoints[indexOfPlayer][indexOfChampion];
    assignedLevels[indexOfPlayer] =
      masteryLevels[indexOfPlayer][indexOfChampion];

    masteryPoints[indexOfPlayer] = [0, 0, 0, 0, 0];

    for (let j = 0; j < 5; j++) {
      masteryPoints[j][indexOfChampion] = 0;
    }
  }
  console.log(assignedPoints);
  const myObject2 = {
    players: {
      player1: {
        name: names.list[0],
        assignedChamp: assignedChamps[0],
        key: newChampList[0],
        puuid: puuids[0],
      },
      player2: {
        name: names.list[1],
        assignedChamp: assignedChamps[1],
        key: newChampList[1],
        puuid: puuids[1],
      },
      player3: {
        name: names.list[2],
        assignedChamp: assignedChamps[2],
        key: newChampList[2],
        puuid: puuids[2],
      },
      player4: {
        name: names.list[3],
        assignedChamp: assignedChamps[3],
        key: newChampList[3],
        puuid: puuids[3],
      },
      player5: {
        name: names.list[4],
        assignedChamp: assignedChamps[4],
        key: newChampList[4],
        puuid: puuids[4],
      },
    },
    region: names.options[randomRegion],
    order: orderList,
    pointsList: assignedPoints,
    levelList: assignedLevels,
  };

  res.status(200).send(myObject2);
});

export default masteryRouter;
