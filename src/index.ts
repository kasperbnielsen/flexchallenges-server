import "dotenv/config";
import express from "express";
import { cors } from "./middleware/cors";
import masteryRouter from "./routes/mastery";

const app = express();

app.use(express.json());

app.use(cors);

app.get("/", (req, res) => {
  res.status(200).send("hello world!");
});

app.use("/riot", masteryRouter);

app.listen(process.env.PORT ?? 5000, () => {
  console.log("listening on port", process.env.PORT ?? 5000);
});
