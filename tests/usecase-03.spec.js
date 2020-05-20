import { expect } from 'chai'
import { User, Role, Company } from './models'

describe('Use Cases - 03', () => {
  describe('::skip and limit', () => {
    it('should select the first one', done => {
      User.findAll({ skip: 0, limit: 1, order_by: [{ key: 'toUpper(user.email)' }] })
        .then(users => {
          expect(users.toValues()[0].email).to.be.equal('email@domain.com')
          expect(users.toValues()).to.have.lengthOf(1)
        })
        .then(() => done(), done)
    })

    it('should select the second one', done => {
      User.findAll({ skip: 1, limit: 1, order_by: [{ key: 'email' }] })
        .then(users => {
          expect(users.first().email).to.be.equal('emailupdated@domain.com')
          expect(users.toValues()).to.have.lengthOf(1)
        })
        .then(() => done(), done)
    })
  })
  describe('::relationship', () => {
    let role
    let role2
    let user
    let user2

    it('selecting role and user', done => {
      Role.findAll().then(roles => {
        role = roles[0]
        role2 = roles[1]
        User.findAll()
          .then(users => {
            user = users.toValues()[0]
            user2 = users.toValues()[1]
          })
          .then(() => done(), done)
      })
    })

    it('relating 1', done => {
      user
        .createRelationship('role', role)
        .then(() => {
          expect(user.role.key).to.be.equal('key-ADMIN')
        })
        .then(() => done(), done)
    })

    it('relating with attributes', done => {
      user
        .createRelationship('friends', user2, { intimacy: 'normal' })
        .then(() => {
          expect(user.toJSON().friends[0].intimacy).to.be.equal('normal')
        })
        .then(() => done(), done)
    })

    it('update a relationship', done => {
      user
        .updateRelationship('friends', user2, { intimacy: 'close' })
        .then(() => {
          expect(user.toJSON().friends[0].intimacy).to.be.equal('close')
        })
        .then(() => done(), done)
    })

    it('fetching a relationship', done => {
      user
        .fetch(['friends', 'role'])
        .then(() => {
          expect(user.role.key).to.be.equal('key-ADMIN')
        })
        .then(() => done(), done)
    })

    it('get all builds from company with_related 1 level', done => {
      Company.findAll({
        with_related: ['builds'],
      })
        .then(companies => {
          expect(companies[0].builds.length()).to.be.equal(2)
        })
        .then(() => done(), done)
    })

    it('get all users with_related 2 levels', done => {
      User.findAll({
        with_related: ['role__name', 'companies__builds'],
      })
        .then(users => {
          const companies = users[1].companies[0] || users[0].companies[0]
          expect(companies.builds.length()).to.be.equal(2)
        })
        .then(() => done(), done)
    })
  })
})
