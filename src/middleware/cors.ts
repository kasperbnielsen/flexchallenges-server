import { Request, Response, NextFunction } from "express";

export function cors(request: Request, response: Response, next: NextFunction) {
  if (request.originalUrl !== "/")
    console.log(request.method, request.originalUrl);

  response.set({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "*",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*",
  });

  next();
}
