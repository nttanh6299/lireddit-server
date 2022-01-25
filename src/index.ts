import 'reflect-metadata'
import 'dotenv-safe/config'
import express from 'express'
import Redis from 'ioredis'
import session from 'express-session'
import connectRedis from 'connect-redis'
import path from 'path'
import { ApolloServer } from 'apollo-server-express'
import { buildSchema } from 'type-graphql'
import cors from 'cors'
import { COOKIE_NAME, __prod__ } from './constants'
import resolvers from './resolvers'
import { MyContext } from './types'
import { createConnection } from 'typeorm'
import { Post } from './entities/Post'
import { User } from './entities/User'
import { Updoot } from './entities/Updoot'
import { createUserLoader } from './utils/createUserLoader'
import { createUpdootLoader } from './utils/createUpdootLoader'

const main = async () => {
  const conn = await createConnection({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    logging: true,
    // synchronize: true,
    migrations: [path.join(__dirname, './migrations/*')],
    entities: [Post, User, Updoot],
  })

  await conn.runMigrations()

  // await Post.delete({})

  const app = express()

  const RedisStore = connectRedis(session)
  const redis = new Redis(process.env.REDIS_URL)

  app.set('proxy', 1)
  app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  }))
  app.use(
    session({
      name: COOKIE_NAME,
      store: new RedisStore({
        client: redis,
        disableTTL: true,
        disableTouch: true,
      }),
      cookie: {
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years
        httpOnly: true,
        secure: __prod__, // cookie only works in https
        sameSite: 'lax', // csrf
        domain: __prod__ ? '.codeponder.com' : undefined,
      },
      saveUninitialized: false,
      resave: false,
      secret: process.env.SESSION_SECRET,
    })
  )

  const apolloServer = new ApolloServer({
    schema: await buildSchema({
      resolvers,
      validate: false
    }),
    context: ({ req, res }): MyContext => ({
      req,
      res,
      redis,
      userLoader: createUserLoader(),
      updootLoader: createUpdootLoader()
    })
  })

  apolloServer.applyMiddleware({ app, cors: false })

  app.listen(parseInt(process.env.PORT), () => console.log('Server started on localhost:4000'))
}

main().catch(err => console.log(err))