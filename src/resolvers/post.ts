import { Post } from "../entities/Post"
import { Arg, Ctx, Field, FieldResolver, InputType, Int, Mutation, ObjectType, Query, Resolver, Root, UseMiddleware } from "type-graphql"
import { MyContext } from "../types"
import { isAuth } from "../middlewares/isAuth"
import { getConnection } from "typeorm"
import { Updoot } from "../entities/Updoot"
import { User } from "../entities/User"

@InputType()
class PostInput {
  @Field()
  title: string

  @Field()
  text: string
}

@ObjectType()
class PaginatedPosts {
  @Field(() => [Post])
  posts: Post[]

  @Field()
  hasMore: boolean
}

@Resolver(Post)
export class PostResolver {
  @FieldResolver(() => String)
  textSnippet(
    @Root() root: Post
  ) {
    return root.text.slice(0, 50)
  }

  @FieldResolver(() => User)
  creator(@Root() post: Post, @Ctx() { userLoader }: MyContext) {
    return userLoader.load(post.creatorId)
  }

  @FieldResolver(() => Int, { nullable: true })
  async voteStatus(@Root() post: Post, @Ctx() { updootLoader, req }: MyContext) {
    if (!req.session.userId) {
      return null
    }
    const updoot = await updootLoader.load({ postId: post.id, userId: req.session.userId })
    return updoot ? updoot.value : null
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async vote(
    @Arg('postId', () => Int) postId: number,
    @Arg('value', () => Int) value: number,
    @Ctx() { req }: MyContext
  ) {
    const { userId } = req.session
    const isUpdoot = value !== -1
    const realValue = isUpdoot ? 1 : -1

    const updoot = await Updoot.findOne({ where: { postId, userId } })

    if (updoot && updoot.value !== realValue) {
      await getConnection().transaction(async tm => {
        await tm.query(`
          update updoot
          set value = $1
          where "postId" = $2 and "userId" = $3
        `, [realValue, postId, userId])

        await tm.query(`
          update post
          set points = points + $1
          where id = $2
        `, [2 * realValue, postId])
      })
    } else if (!updoot) {
      // if one of queries is failed, they both failed
      await getConnection().transaction(async tm => {
        await tm.query(`
          insert into updoot ("userId", "postId", value)
          values ($1, $2, $3)
        `, [userId, postId, realValue])

        await tm.query(`
          update post
          set points = points + $1
          where id = $2
        `, [realValue, postId])
      })
    }
    return true
  }

  @Query(() => PaginatedPosts)
  async posts(
    @Arg('limit', () => Int) limit: number,
    @Arg('cursor', () => String, { nullable: true }) cursor: string
  ): Promise<PaginatedPosts> {
    const realLimit = Math.min(50, limit)
    const realLimitPlusOne = realLimit + 1

    const replacements: any[] = [realLimitPlusOne]

    if (cursor) {
      replacements.push(new Date(+cursor))
    }

    const posts = await getConnection().query(`
      select p.*
      from post p
      ${cursor ? `where p."createdAt" < $2` : ''}
      order by p."createdAt" DESC
      limit $1
    `, replacements)

    return { posts: posts.slice(0, realLimit), hasMore: posts.length === realLimitPlusOne }
  }

  @Query(() => Post, { nullable: true })
  post(
    @Arg('id', () => Int) id: number,
  ): Promise<Post | undefined> {
    return Post.findOne(id)
  }

  @Mutation(() => Post)
  @UseMiddleware(isAuth)
  async createPost(
    @Arg('input') input: PostInput,
    @Ctx() { req }: MyContext
  ): Promise<Post> {
    return Post.create({ ...input, creatorId: req.session.userId }).save()
  }

  @Mutation(() => Post, { nullable: true })
  @UseMiddleware(isAuth)
  async updatePost(
    @Arg('id', () => Int) id: number,
    @Arg('title') title: string,
    @Arg('text') text: string,
    @Ctx() { req }: MyContext
  ): Promise<Post | null> {
    const post = await Post.findOne({ id, creatorId: req.session.userId })

    if (!post) return null

    post.title = title
    post.text = text
    await post.save()

    return post
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async deletePost(
    @Arg('id', () => Int) id: number,
    @Ctx() { req }: MyContext
  ): Promise<boolean> {
    // non cascade way
    // const post = await Post.findOne(id)
    // if (!post) return false
    // if (post.creatorId !== req.session.userId) {
    //   throw new Error('not authorized')
    // }
    // await Updoot.delete({ postId: id })
    // await Post.delete({ id })

    // cascade way
    await Post.delete({ id, creatorId: req.session.userId })
    return true
  }
}