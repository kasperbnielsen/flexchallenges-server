import { Router } from "express";
import { MongoClient } from "mongodb";

const MONGODBHOST = process.env.MONGODB_HOST;
if (!MONGODBHOST) throw new Error("MONGODBHOST Mssing!");

const databaseClient = new MongoClient(MONGODBHOST);
const connection = databaseClient.connect().then((c) => c.db("production"));

const matchesRouter = Router();

matchesRouter.get("/championstats/:puuid", async (req, res) => {
  const coll = await connection;

  if (!req.query.refresh) {
    const id = await coll
      .collection("matchCache")
      .findOne({ puuid: req.params.puuid });
    if (id?.stats?.length) {
      res.status(200).send(id.stats);
      return;
    }
  }

  const pipeline = [
    {
      $match: {
        "metadata.participants": req.params.puuid,
      },
    },
    {
      $unwind: "$info.participants",
    },
    {
      $match: {
        "info.participants.puuid": req.params.puuid,
      },
    },
    {
      $group: {
        _id: "$info.participants.championId",
        totalKills: {
          $sum: "$info.participants.kills",
        },
        totalDeaths: {
          $sum: "$info.participants.deaths",
        },
        totalAssists: {
          $sum: "$info.participants.assists",
        },
        totalMatches: {
          $sum: 1,
        },
        totalWins: {
          $sum: {
            $cond: ["$info.participants.win", 1, 0],
          },
        },
      },
    },
    {
      $sort: { totalMatches: -1, totalWins: -1, _id: 1 },
    },
  ];

  const document = await coll
    .collection("matches")
    .aggregate<{
      _id: number;
      totalKills: number;
      totalDeaths: number;
      totalAssists: number;
      totalMatches: number;
      totalWins: number;
    }>(pipeline)
    .toArray();

  res.status(200).send(document);

  if (!document.length) return;

  await coll.collection("matchCache").updateOne(
    { puuid: req.params.puuid },
    {
      $set: {
        createdAt: new Date(),
        stats: document,
      },
      $setOnInsert: {
        puuid: req.params.puuid,
      },
    },
    { upsert: true }
  );
});

export default matchesRouter;
