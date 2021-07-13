from pyteal import *

def approval_program():
    """
    A stateful smart contract which will store the bond parameters:
    issue price, nominal price, maturity date and coupon value, total amount.
    Additionally, the App will store a reference to the currently
    tradeable bond ASA and the current epoch number.
    """

    store_manager = Bytes("store_manager")
    issue_price = Bytes("issue_price")
    nominal_price = Bytes("nominal_price")
    maturity_date = Bytes("maturity_date")
    coupon_value = Bytes("coupon_value")
    issuer_address = Bytes("issuer_address")
    epoch = Bytes("epoch")
    total = Bytes("total")
    current_bond = Bytes("current_bond")
    max_amount = Bytes("max_amount")
    creator = Bytes("creator")

    # verify rekey_to and close_rem_to are set as zero_address
    basic_checks = And(
        # Always verify that the RekeyTo property of any transaction is set to the ZeroAddress
        # unless the contract is specifically involved ina rekeying operation.
        Txn.rekey_to() == Global.zero_address(),
        Txn.close_remainder_to() == Global.zero_address(),
        Txn.asset_close_to() == Global.zero_address()
    )

    # initialize variables
    on_initialize = Seq([
        App.globalPut(store_manager, Txn.application_args[0]),
        App.globalPut(issue_price, Btoi(Txn.application_args[1])),
        App.globalPut(nominal_price, Btoi(Txn.application_args[2])),
        App.globalPut(maturity_date, Btoi(Txn.application_args[3])),
        App.globalPut(coupon_value, Btoi(Txn.application_args[4])),
        App.globalPut(epoch, Btoi(Txn.application_args[5])),
        App.globalPut(current_bond, Btoi(Txn.application_args[6])),
        App.globalPut(max_amount, Btoi(Txn.application_args[7])),
        App.globalPut(creator, Txn.application_args[8]),
        Return(Int(1))
    ])

    # only store manager can update issuer
    update_issuer = Seq([
        Assert(
             And(
                Txn.sender() == App.globalGet(store_manager),
                basic_checks
            )
        ),
        App.globalPut(issuer_address, Txn.application_args[1]),
        Return(Int(1))
    ])

    # only bond app manager can update issue price
    on_update_issue_price = Seq([
        Assert(
             And(
                Txn.sender() == App.globalGet(store_manager),
                basic_checks
            )
        ),
        App.globalPut(issue_price, Txn.application_args[1]),
        Return(Int(1))
    ])

    on_issue = Seq([
        Assert(
            And(
                Gtxn[0].type_enum() == TxnType.AssetTransfer,
                Gtxn[0].asset_receiver() == App.globalGet(issuer_address),
                Gtxn[0].xfer_asset() == App.globalGet(current_bond),
                basic_checks
            )
        ),
        Return(Int(1))
    ])

    on_buy = Seq([
        Assert(
            And(
                basic_checks,
                # verify payment
                Gtxn[0].type_enum() == TxnType.Payment,
                # verify buying amount,
                Gtxn[0].amount() >= Add(Mul(Gtxn[1].asset_amount(), App.globalGet(issue_price)), Gtxn[1].fee()),
                # verify ASA transfer
                Gtxn[1].type_enum() == TxnType.AssetTransfer,
                Gtxn[1].xfer_asset() == App.globalGet(current_bond),
                Gtxn[1].asset_receiver() == Gtxn[0].sender()
            )
        ),
        App.globalPut(total, Add(App.globalGet(total), Gtxn[1].asset_amount())),
        Return(Int(1))
    ])

    # store buyback address
    create_buyback = Seq([
        Assert(
            And(
                Txn.sender() == App.globalGet(store_manager),
                basic_checks
            )
        ),
        App.globalPut(Bytes("buyback"), Txn.application_args[1]),
        Return(Int(1))
    ])

    on_exit = Seq([
        Assert(
            And(
                basic_checks,
                # verify first transaction is asset transfer
                Gtxn[0].type_enum() == TxnType.AssetTransfer,
                # verify second transaction is payment
                Gtxn[1].type_enum() == TxnType.Payment,
                # verify sender of first transaction is buyback address
                Gtxn[1].sender() == App.globalGet(Bytes("buyback")),
                # verify amount of algo received by buyer
                Gtxn[1].amount() == Minus(Mul(Gtxn[0].asset_amount(), App.globalGet(nominal_price)), Gtxn[1].fee()),
                Gtxn[1].receiver() == Txn.sender(),
                # verify maturity date is passed
                Global.latest_timestamp() > App.globalGet(maturity_date)
            )
        ),
        Return(Int(1))
    ])

    on_redeem_coupon = Seq([
        Assert(
            And(
                basic_checks,
                # User sends `B_i` to `DEX_i` lsig.
                Gtxn[0].type_enum() == TxnType.AssetTransfer,
                # `DEX_i` sends `B_{i+1}` to the user.
                Gtxn[1].type_enum() == TxnType.AssetTransfer,
                Gtxn[0].asset_amount() == Gtxn[1].asset_amount(),
                # `Dex_i` sends coupon value to user
                Gtxn[2].type_enum() == TxnType.Payment,
                Gtxn[2].receiver() == Txn.sender(),
                # verify coupon amount
                Gtxn[2].amount() == Mul(Gtxn[0].asset_amount(), App.globalGet(coupon_value))
            )
        ),
        Return(Int(1))
    ])

    # fetch asset_holding.balance from Txn.accounts[0]
    asset_balance = AssetHolding.balance(Int(1), Gtxn[2].xfer_asset())

    on_create_dex = Seq([
        asset_balance, # load asset_balance from store
        Assert(
            And(
                Txn.sender() == App.globalGet(store_manager),
                basic_checks,
                Gtxn[1].type_enum() == TxnType.AssetTransfer,
                # transfer `balanceOf(issuer, B_i)`  of `B_{i+1}` from the creator to the `issuer`.
                # index 1 of Txn.accounts().
                asset_balance.value() == Gtxn[1].asset_amount(),
                # burn `B_i` issuer bonds. send to creator
                Gtxn[2].type_enum() == TxnType.AssetTransfer,
                Gtxn[2].asset_receiver() == App.globalGet(creator),
                asset_balance.value() == Gtxn[2].asset_amount()
            ),
        ),
        # Increment `BondApp.epoch`
        App.globalPut(epoch, Add(App.globalGet(epoch), Int(1))),
        # set `BondApp.current_bond = B_{i+1}`.
        App.globalPut(current_bond, Gtxn[1].xfer_asset()),
        Return(Int(1))
    ])

    program = Cond(
        # Verfies that the application_id is 0, jumps to on_initialize.
        [Txn.application_id() == Int(0), on_initialize],
        # Verifies Update transaction, rejects it.
        [Txn.on_completion() == OnComplete.UpdateApplication, Return(Int(0))],
        # Verifies delete transaction, rejects it.
        [Txn.on_completion() == OnComplete.DeleteApplication, Return(Int(0))],
        # Verifies closeout transaction, approves it.
        [Txn.on_completion() == OnComplete.CloseOut, Return(Int(1))],
        # Verifies opt-in transaction, approves it.
        [Txn.on_completion() == OnComplete.OptIn, Return(Int(1))],
        # Verifies update issuer address transaction, jumps to update_issuer branch.
        [Txn.application_args[0] == Bytes("update_issuer_address"), update_issuer],
        # Verifies update issue, jumps to on_issue branch.
        [Txn.application_args[0] == Bytes("issue"), on_issue],
        # Verifies buy transaction, jumps to on_buy branch.
        [Txn.application_args[0] == Bytes("buy"), on_buy],
        # Verifies create buyback transaction, jumps to create_buyback branch.
        [Txn.application_args[0] == Bytes("create_buyback"), create_buyback],
        # Verifies exit transaction, jumps to on_exit branch.
        [Txn.application_args[0] == Bytes("exit"), on_exit],
        # Verifies redeem coupon transaction, jumps to on_redeem_coupon branch.
        [Txn.application_args[0] == Bytes("redeem_coupon"), on_redeem_coupon],
        # Verifies update issue price transaction, jumps to on_update_issue_price branch.
        [Txn.application_args[0] == Bytes("update_issue_price"), on_update_issue_price],
        # Verifies create dex transaction, jumps to on_create_dex branch.
        [Txn.application_args[0] == Bytes("create_dex"), on_create_dex],
    )

    return program

if __name__ == "__main__":
    print(compileTeal(approval_program(), Mode.Application, version=3))
