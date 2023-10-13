import { Router } from "express";

const leagueRouter = Router();

leagueRouter.get("/:region", async (req, res) => {
  const url = `https://${req.params.region}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5`;

  const data = await fetch(url, { method: "GET" }).then((res) => res.json());

  res.status(200).send(data);
});

export default leagueRouter;
