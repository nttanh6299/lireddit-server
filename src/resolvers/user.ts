import argon2 from 'argon2'
import { User } from "../entities/User"
import { MyContext } from "../types"
import { Arg, Ctx, Field, FieldResolver, InputType, Mutation, ObjectType, Query, Resolver, Root } from "type-graphql"
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants'
import { sendEmail } from '../utils/sendEmail'
import { v4 } from 'uuid'

@InputType()
class UserInput {
  @Field()
  username: string

  @Field()
  password: string

  @Field()
  email: string
}

@ObjectType()
class FieldError {
  @Field()
  field: string

  @Field()
  message: string
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[]

  @Field(() => User, { nullable: true })
  user?: User
}

@Resolver(User)
export class UserResolver {
  @FieldResolver(() => String)
  email(@Root() user: User, @Ctx() { req }: MyContext) {
    if (req.session.userId === user.id) {
      return user.email
    }

    return ''
  }

  @Mutation(() => UserResponse)
  async changePassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Ctx() { redis, req }: MyContext
  ): Promise<UserResponse> {
    if (newPassword.length <= 3) {
      return {
        errors: [{
          field: 'newPassword',
          message: 'Password must be greater than 3'
        }],
      }
    }

    const key = FORGET_PASSWORD_PREFIX + token
    const userId = await redis.get(key)
    if (!userId) {
      return {
        errors: [{
          field: 'token',
          message: 'token expired'
        }],
      }
    }

    const userIdNum = Number(userId)
    const user = await User.findOne(userIdNum)

    if (!user) {
      return {
        errors: [{
          field: 'token',
          message: 'user no longer exists'
        }],
      }
    }

    const hashedPassword = await argon2.hash(newPassword)
    await User.update({ id: userIdNum }, { password: hashedPassword })

    await redis.del(key)

    req.session.userId = user.id


    return { user }
  }

  @Mutation(() => Boolean)
  async forgotPassword(@Arg('email') email: string, @Ctx() { redis }: MyContext) {
    const user = await User.findOne({ where: { email } })

    if (!user) {
      return true
    }

    const token = v4()

    await redis.set(FORGET_PASSWORD_PREFIX + token, user.id, 'ex', 1000 * 60 * 60 * 24 * 3)

    await sendEmail(email, `<a href="http://localhost:3000/change-password/${token}">Reset password</a>`)

    return true
  }

  @Query(() => User, { nullable: true })
  me(@Ctx() { req }: MyContext) {
    const userId = req.session.userId

    if (!userId) return null

    return User.findOne(userId)
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UserInput,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const { username, password, email } = options

    if (!email.includes('@')) {
      return {
        errors: [{
          field: 'email',
          message: 'Invalid email'
        }],
      }
    }

    if (username.length <= 2) {
      return {
        errors: [{
          field: 'username',
          message: 'Username must be greater than 2'
        }],
      }
    }

    if (password.length <= 3) {
      return {
        errors: [{
          field: 'password',
          message: 'Password must be greater than 3'
        }],
      }
    }

    let user

    try {
      const hashedPassword = await argon2.hash(password)
      user = await User.create({ username, password: hashedPassword, email }).save()
      req.session.userId = user?.id
      console.log("user ", user)
    } catch (error) {
      if (error.code === '23505') {
        return {
          errors: [{
            field: 'username',
            message: 'Username already taken'
          }],
        }
      }
    }

    return { user }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg('username') username: string,
    @Arg('password') password: string,
    @Ctx() { req }: MyContext
  ): Promise<UserResponse> {
    const user = await User.findOne({ where: { username } })

    if (!user) {
      return {
        errors: [{
          field: 'username',
          message: "That username doesn't exists"
        }]
      }
    }

    const valid = await argon2.verify(user.password, password)
    if (!valid) {
      return {
        errors: [{
          field: 'password',
          message: "Incorrect password"
        }]
      }
    }

    req.session.userId = user.id

    return { user }
  }

  @Mutation(() => Boolean)
  async logout(
    @Ctx() { req, res }: MyContext
  ) {

    return new Promise(resolve => req.session.destroy(err => {
      res.clearCookie(COOKIE_NAME)
      if (err) {
        console.log("Error - logout: ", err)
        resolve(false)
        return
      }
      resolve(true)
    }))
  }
}